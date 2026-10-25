export type ContractStateRow = Readonly<{
  system_id: string;
  severity: string;
}>;

export const formatContractStateLine = (state: ContractStateRow): string =>
  `${state.system_id} ${state.severity}`;
