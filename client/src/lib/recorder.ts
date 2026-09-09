export interface VoiceRecording {
  /** dataURL base64 du fichier audio produit. */
  dataUrl: string;
  mimeType: string;
  durationMs: number;
}

export interface RecordingSession {
  stop: () => Promise<VoiceRecording>;
  cancel: () => void;
}

export function recordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof MediaRecorder !== "undefined"
  );
}

const MAX_MS = 120_000;

/** Démarre un enregistrement microphone (MediaRecorder).
 *  Le stop renvoie le vocal en dataURL ; cancellation libère le micro. */
export async function startRecording(): Promise<RecordingSession> {
  if (!recordingSupported()) {
    throw new Error("Enregistrement vocal non supporté sur cet appareil");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
  const type = candidates.find((t) => t && MediaRecorder.isTypeSupported(t)) ?? "";
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  recorder.start(250);
  const t0 = performance.now();

  let pending: Promise<VoiceRecording> | null = null;
  const recorderMime = () => recorder.mimeType || type || "audio/webm";

  const stop = () => {
    if (pending) return pending;
    pending = new Promise<VoiceRecording>((resolve, reject) => {
      const finish = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorderMime() });
        const durationMs = performance.now() - t0;
        if (durationMs < 500 || blob.size < 100) {
          reject(new Error("Vocal trop court — parle un peu plus longtemps"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () =>
          resolve({ dataUrl: String(reader.result), mimeType: recorderMime(), durationMs: Math.round(durationMs) });
        reader.onerror = () => reject(new Error("Lecture du vocal impossible"));
        reader.readAsDataURL(blob);
      };
      recorder.onstop = finish;
      try {
        if (recorder.state !== "inactive") recorder.stop();
        else finish();
      } catch (err) {
        reject(err);
      }
    });
    return pending;
  };

  // Sécurité : un vocal ne dépasse jamais 2 minutes.
  const guard = setTimeout(() => {
    if (recorder.state !== "inactive") stop();
  }, MAX_MS);

  return {
    stop,
    cancel: () => {
      clearTimeout(guard);
      if (recorder.state !== "inactive") {
        try {
          recorder.onstop = null;
          recorder.stop();
        } catch {
          /* déjà arrêté */
        }
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}