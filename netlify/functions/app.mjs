import sensor from './lib/sensor-handler.cjs';

export default async function () {
  const result = await sensor.handler();
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
}
