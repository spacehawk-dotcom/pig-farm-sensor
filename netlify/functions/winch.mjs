import winch from './lib/winch-handler.cjs';

export default async function (request) {
  const result = await winch.handler({
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.text(),
  });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}
