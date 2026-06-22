export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const target = url.hostname.includes('hogwarts-english')
      ? '/hogwarts-english.html'
      : '/hogwarts-espanol.html';
    return Response.redirect(new URL(target, url).href, 302);
  }

  return next();
}
