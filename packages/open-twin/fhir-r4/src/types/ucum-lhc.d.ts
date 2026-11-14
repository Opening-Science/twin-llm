/**
 * Ambient types for `@lhncbc/ucum-lhc`, which ships no declarations.
 *
 * Declared as named exports rather than a default, because that is the shape the
 * CommonJS entry point actually exposes under Node's ESM interop and the shape
 * `verify/check-units.mjs` already relies on. Only the surface this package uses is
 * declared; widen it rather than reaching for `any`.
 */
declare module '@lhncbc/ucum-lhc' {
  export interface UcumValidationResult {
    status: 'valid' | 'invalid' | 'error';
    ucumCode?: string | null;
    msg?: string[];
    suggestions?: unknown;
  }

  export interface UcumConversionResult {
    status: 'succeeded' | 'failed' | 'error';
    toVal?: number;
    msg?: string[];
  }

  export interface UcumLhcUtilsInstance {
    validateUnitString(unitString: string, suggest?: boolean): UcumValidationResult;
    convertUnitTo(fromUnitCode: string, fromVal: number, toUnitCode: string, suggest?: boolean): UcumConversionResult;
  }

  export const UcumLhcUtils: { getInstance(): UcumLhcUtilsInstance };
}
