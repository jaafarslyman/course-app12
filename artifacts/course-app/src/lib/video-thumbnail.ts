export function captureVideoPosterFrame(
  source: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('video_thumbnail_capture_aborted'));
      return;
    }

    const video = document.createElement('video');
    let timeoutId = 0;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', captureFrame);
      video.removeEventListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('video_thumbnail_frame_unavailable'));
    };

    const handleAbort = () => {
      cleanup();
      reject(new Error('video_thumbnail_capture_aborted'));
    };

    const captureFrame = () => {
      try {
        if (video.videoWidth < 1 || video.videoHeight < 1) {
          throw new Error('video_thumbnail_dimensions_unavailable');
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('video_thumbnail_canvas_unavailable');

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL('image/jpeg', 0.82);
        cleanup();
        resolve(frame);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadeddata', captureFrame, { once: true });
    video.addEventListener('error', handleError, { once: true });
    signal.addEventListener('abort', handleAbort, { once: true });
    timeoutId = window.setTimeout(handleError, 15_000);
    video.src = source;
    video.load();
  });
}
