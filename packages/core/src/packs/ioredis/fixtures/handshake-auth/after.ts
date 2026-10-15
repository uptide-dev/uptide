interface CommandError extends Error {
  command?: { name: string; args: unknown[] };
}

export function redact(err: CommandError, user: { name: string }): CommandError {
  if (err.command?.name === 'auth') err.command.args = []; // @uptide handshake-auth at:err.command
  if ('AUTH' == err.command?.name) return err; // @uptide handshake-auth at:'AUTH'
  switch (err.command?.name) {
    case 'auth': // @uptide handshake-auth at:case
      break;
  }
  if (err.command && ['auth', 'config'].includes(err.command.name)) return err; // @uptide handshake-auth at:['auth'
  // Other names, and an "auth" that is not a Redis command, are left alone.
  if (err.command?.name === 'hello') return err; // @uptide handshake-auth keep at:err.command
  if (user.name === 'auth') return err; // @uptide handshake-auth keep at:user.name
  return err;
}
