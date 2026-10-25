import { z } from "zod";

export const gbdPopulationInput = z
  .object({
    measure: z.enum(["deaths", "dalys", "yld", "yll", "prevalence", "incidence"]),
    sex: z.enum(["both", "male", "female"]),
    age: z.enum(["all_ages", "age_standardized"]),
    year: z.enum(["2019", "2020", "2021"]),
    location: z.enum([
      "Global",
      "United States of America",
      "United Kingdom",
      "Switzerland",
    ]),
    cause: z.enum([
      "All causes",
      "Cardiovascular diseases",
      "Neoplasms",
      "Diabetes mellitus",
    ]),
  })
  .strict();

export type GbdInput = z.infer<typeof gbdPopulationInput>;
