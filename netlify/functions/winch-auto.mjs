import winch from './lib/winch-handler.cjs';

export default async function () {
  await winch.scheduled();
  return new Response(null, {status:204});
}

export const config = {schedule:'*/5 * * * *'};
