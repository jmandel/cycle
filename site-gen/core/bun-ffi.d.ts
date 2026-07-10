declare module 'bun:ffi' {
  export const FFIType: {
    readonly i32: number;
    readonly ptr: number;
    readonly u32: number;
  };

  export function ptr(value: ArrayBufferView): number;

  export const read: {
    i32(pointer: number, byteOffset?: number): number;
  };

  interface ForeignFunctionDefinition {
    readonly args: readonly number[];
    readonly returns: number;
  }

  type ForeignFunction = (...args: number[]) => number;

  export function dlopen<T extends Record<string, ForeignFunctionDefinition>>(
    path: string,
    definitions: T,
  ): {
    readonly symbols: { readonly [K in keyof T]: ForeignFunction };
    close(): void;
  };
}
