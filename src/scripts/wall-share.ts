export async function shareWallEntry(url: string, title: string, status: HTMLElement, fallback: HTMLInputElement) {
  fallback.hidden = true;
  status.textContent = '';
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Link copied.';
  } catch {
    fallback.value = url;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    status.textContent = 'Copy the selected link to share this post.';
  }
}
