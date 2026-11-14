/**
 * Minimal ambient types for `@lhncbc/ucum-lhc`, which ships no declarations.
 * Only the surface the unit tests use is declared; widen as needed.
 */
declare module '@lhncbc/ucum-lhc' {
  interface ValidationResult {
    status: 'valid' | 'invalid' | 'error';
    ucumCode?: string | null;
    msg?: string[];
    suggestions?: unknown;
  }

  interface ConversionResult {
    status: 'succeeded' | 'failed' | 'error';
    toVal?: number;
    msg?: string[];
  }

  interface UcumLhcUtilsInstance {
    validateUnitString(unitString: string, suggest?: boolean): ValidationResult;
    convertUnitTo(fromUnitCode: string, fromVal: number, toUnitCode: string, suggest?: boolean): ConversionResult;
  }

  const ucum: {
    UcumLhcUtils: { getInstance(): UcumLhcUtilsInstance };
  };

  export default ucum;
}
