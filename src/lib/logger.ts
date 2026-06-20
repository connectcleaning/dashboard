type Level = 'info' | 'warn' | 'error';

function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  info:  (msg: string, data?: Record<string, unknown>) => log('info',  msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => log('warn',  msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
};
