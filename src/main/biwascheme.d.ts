declare module "biwascheme" {
  class Pause {
    constructor(onPause: (pause: Pause) => void);
    resume(value: unknown): unknown;
  }
  class Interpreter {
    constructor(onError: (error: Error) => never);
    evaluate(source: string): unknown;
    invoke_closure(closure: unknown, args: unknown[]): unknown;
  }
  const BiwaScheme: {
    CoreEnv: Record<string, unknown>;
    Pause: typeof Pause;
    Interpreter: typeof Interpreter;
    define_libfunc(name: string, min: number, max: number, fn: (args: unknown[]) => unknown): void;
  };
  export default BiwaScheme;
}

declare module "*biwascheme.mjs" {
  import BiwaScheme from "biwascheme";
  export default BiwaScheme;
}
