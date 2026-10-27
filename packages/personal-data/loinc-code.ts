/**
 * Is this text a well-formed LOINC code? Digits, a dash and the check digit
 * (LOINC's mod-10 algorithm, the same as Luhn's), so a typo like `4548-5`
 * is caught. It does not say the code exists; only the LOINC table could.
 */

const LOINC_FORMAT = /^(\d{1,7})-(\d)$/;

const mod10CheckDigit = (digits: string): number => {
  const sum = [...digits].reverse().reduce((total, char, index) => {
    const digit = Number(char);
    if (index % 2 === 1) return total + digit;
    const doubled = digit * 2;
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return (10 - (sum % 10)) % 10;
};

export const isLoincCode = (text: string): boolean => {
  const match = LOINC_FORMAT.exec(text.trim());
  return match !== null && mod10CheckDigit(match[1]!) === Number(match[2]);
};
