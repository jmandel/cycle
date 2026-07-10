/** Bun-native atomic directory publication without destination replacement. */
import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { rename } from 'node:fs/promises';

function cString(value: string): Buffer {
  if (value.includes('\0')) throw new Error('Rename path contains NUL');
  return Buffer.from(`${value}\0`);
}

function nativeFailure(operation: string, errno: number): Error {
  return new Error(`${operation} failed with errno ${errno}`);
}

function renameLinux(source: string, destination: string): void {
  const library = dlopen('libc.so.6', {
    renameat2: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    __errno_location: { args: [], returns: FFIType.ptr },
  });
  try {
    const sourceBytes = cString(source);
    const destinationBytes = cString(destination);
    const result = library.symbols.renameat2(
      -100, // AT_FDCWD
      ptr(sourceBytes),
      -100,
      ptr(destinationBytes),
      1, // RENAME_NOREPLACE
    );
    if (result !== 0) {
      throw nativeFailure('renameat2(RENAME_NOREPLACE)', read.i32(library.symbols.__errno_location(), 0));
    }
  } finally {
    library.close();
  }
}

function renameMac(source: string, destination: string): void {
  const library = dlopen('/usr/lib/libSystem.B.dylib', {
    renamex_np: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    __error: { args: [], returns: FFIType.ptr },
  });
  try {
    const sourceBytes = cString(source);
    const destinationBytes = cString(destination);
    const result = library.symbols.renamex_np(
      ptr(sourceBytes),
      ptr(destinationBytes),
      4, // RENAME_EXCL
    );
    if (result !== 0) {
      throw nativeFailure('renamex_np(RENAME_EXCL)', read.i32(library.symbols.__error(), 0));
    }
  } finally {
    library.close();
  }
}

/**
 * Rename one same-filesystem directory only if `destination` is absent at the
 * kernel commit point. Linux and macOS use exclusive rename syscalls. Windows
 * directory rename already refuses an existing destination. Other platforms
 * fail closed rather than falling back to a check-then-replace race.
 */
export async function renameDirectoryNoReplace(source: string, destination: string): Promise<void> {
  if (process.platform === 'linux') {
    renameLinux(source, destination);
    return;
  }
  if (process.platform === 'darwin') {
    renameMac(source, destination);
    return;
  }
  if (process.platform === 'win32') {
    await rename(source, destination);
    return;
  }
  throw new Error(`Atomic no-replace directory rename is unsupported on ${process.platform}`);
}
