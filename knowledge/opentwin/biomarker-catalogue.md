# Title: Biomarker catalogue

Generated from the pinned Anchor catalogue (@open-twin/anchor-layer, MIT) by
`bun run knowledge:biomarkers`. Do not edit by hand. CC BY 4.0, Open Science
Foundation. LOINC codes and names are © Regenstrief Institute, Inc., used under
the LOINC licence (https://loinc.org/license/). See LICENSE.md.

# Section: About the Anchor biomarker catalogue

TwinLLM knows 67 Anchor biomarkers, the blood markers of the OpenTwin
Anchor layer. Each has a German name, a LOINC code, a UCUM unit, one body system
and one or more regions, all taken from Anchor unchanged. TwinLLM does not score,
rename or reassign them.
30 markers have a published reference interval. A value is placed in an
interval only when exactly one interval fits the person's age and sex and Anchor
has not flagged the unit; otherwise it is shown without a position. Reference
intervals describe a population, not what is right for one person, and TwinLLM
never reads a value as good or bad.

# Section: Markers with no single body location

14 markers describe the whole body rather than one organ (open-twin
decision D12). The body twin lights no region for them, even when Anchor lists one:

- CRP (hochsensitiv) (BM-079), LOINC 30522-7
- Harnsäure (BM-136), LOINC 3084-1
- Hämoglobin (BM-423), LOINC 718-7
- Hämatokrit (BM-424), LOINC 4544-3
- Erythrozyten (BM-425), LOINC 789-8
- Leukozyten (BM-426), LOINC 6690-2
- Thrombozyten (BM-427), LOINC 777-3
- MCV (BM-428), LOINC 787-2
- MCH (BM-429), LOINC 785-6
- MCHC (BM-430), LOINC 786-4
- IgA (BM-431), LOINC 2458-8
- IgG (BM-432), LOINC 2465-3
- IgM (BM-433), LOINC 2472-9
- Kreatinin (BM-436), LOINC 2160-0

# Section: Cardiovascular system markers

- Cholesterin (gesamt) (BM-072): Cholesterol [Mass/volume] in Serum or Plasma. LOINC 2093-3, unit mg/dL, system cardiovascular, region lipid transport, vasculature, liver.
- HDL-Cholesterin (BM-140): Cholesterol in HDL [Mass/volume] in Serum or Plasma. LOINC 2085-9, unit mg/dL, system cardiovascular, region lipid transport, vasculature, liver.
- LDL-Cholesterin (BM-190): Cholesterol in LDL [Mass/volume] in Serum or Plasma. LOINC 2089-1, unit mg/dL, system cardiovascular, region lipid transport, vasculature, liver. No published reference interval.
- Lipoprotein (a) (BM-200): Lipoprotein a [Mass/volume] in Serum or Plasma. LOINC 10835-7, unit mg/dL, system cardiovascular, region lipid transport, vasculature, liver. No published reference interval.
- Triglyceride (BM-383): Triglyceride [Mass/volume] in Serum or Plasma. LOINC 2571-8, unit mg/dL, system cardiovascular, region lipid transport, vasculature, liver.

# Section: Digestive system markers

- Calprotectin (BM-064): Calprotectin [Mass/mass] in Stool. LOINC 38445-3, unit ug/g, system digestive, region gut.
- Gamma-GT (GGT) (BM-123): Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma. LOINC 2324-2, unit U/L, system digestive, region liver, biliary.
- Gesamteiweiß (BM-125): Protein [Mass/volume] in Serum or Plasma. LOINC 2885-2, unit g/L, system digestive, region liver.
- GOT (ASAT) (BM-130): Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma. LOINC 1920-8, unit U/L, system digestive, region liver, skeletal muscle. No published reference interval.
- GPT (ALAT) (BM-132): Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma. LOINC 1742-6, unit U/L, system digestive, region liver.
- SHBG (BM-346): Sex hormone binding globulin [Moles/volume] in Serum or Plasma. LOINC 13967-5, unit nmol/L, system digestive, region liver. No published reference interval.

# Section: Endocrine system markers

- Cortisol (BM-077): Cortisol [Mass/volume] in Serum or Plasma. LOINC 2143-6, unit ng/mL, system endocrine, region adrenal.
- DHEA-S (BM-087): Dehydroepiandrosterone sulfate [Mass/volume] in Serum or Plasma. LOINC 2191-5, unit ng/mL, system endocrine, region adrenal.
- freies T3 (FT3) (BM-114): Triiodothyronine (T3) Free [Mass/volume] in Serum or Plasma. LOINC 3051-0, unit pg/mL, system endocrine, region thyroid.
- freies T4 (FT4) (BM-115): Thyroxine (T4) free [Mass/volume] in Serum or Plasma. LOINC 3024-7, unit pg/mL, system endocrine, region thyroid.
- FSH (BM-119): Follitropin [Units/volume] in Serum or Plasma. LOINC 15067-2, unit U/L, system endocrine, region pituitary, gonads.
- LH (BM-197): Lutropin [Units/volume] in Serum or Plasma. LOINC 10501-5, unit U/L, system endocrine, region pituitary, gonads.
- Parathormon (PTH) (BM-299): Parathyrin.intact [Mass/volume] in Serum or Plasma. LOINC 2731-8, unit pg/mL, system endocrine, region parathyroid, bone. No published reference interval.
- Prolaktin (BM-312): Prolactin [Mass/volume] in Serum or Plasma. LOINC 2842-3, unit ug/L, system endocrine, region pituitary, gonads.
- TSH (BM-386): Thyrotropin [Units/volume] in Serum or Plasma. LOINC 3016-3, unit m[IU]/L, system endocrine, region pituitary, thyroid.

# Section: Metabolic system markers: bone marrow blood

- Ferritin (BM-107): Ferritin [Mass/volume] in Serum or Plasma. LOINC 2276-4, unit ng/mL, system metabolic, region bone marrow blood, micronutrient status.
- Holotranscobalamin (aktives B12) (BM-154): Holo-transcobalamin II [Moles/volume] in Serum. LOINC 72160-5, unit pmol/L, system metabolic, region bone marrow blood, micronutrient status. No published reference interval.
- Hämoglobin (BM-423): Hemoglobin [Mass/volume] in Blood. LOINC 718-7, unit g/dL, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- Hämatokrit (BM-424): Hematocrit [Volume Fraction] of Blood by Automated count. LOINC 4544-3, unit %, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- Erythrozyten (BM-425): Erythrocytes [#/volume] in Blood by Automated count. LOINC 789-8, unit 10*12/L, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- Thrombozyten (BM-427): Platelets [#/volume] in Blood by Automated count. LOINC 777-3, unit 10*9/L, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- MCV (BM-428): Erythrocyte mean corpuscular volume [Entitic volume] by Automated count. LOINC 787-2, unit fL, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- MCH (BM-429): Erythrocyte mean corpuscular hemoglobin [Entitic mass] by Automated count. LOINC 785-6, unit pg, system metabolic, region bone marrow blood. No single body location. No published reference interval.
- MCHC (BM-430): Erythrocyte mean corpuscular hemoglobin concentration [Mass/volume] by Automated count. LOINC 786-4, unit g/dL, system metabolic, region bone marrow blood. No single body location. No published reference interval.

# Section: Metabolic system markers: electrolyte balance

- Magnesium (BM-258): Magnesium [Moles/volume] in Serum or Plasma. LOINC 2601-3, unit mmol/L, system metabolic, region electrolyte balance.

# Section: Metabolic system markers: immune

- Leukozyten (BM-426): Leukocytes [#/volume] in Blood by Automated count. LOINC 6690-2, unit 10*9/L, system metabolic, region immune, bone marrow blood. No single body location. No published reference interval.
- IgA (BM-431): IgA [Mass/volume] in Serum or Plasma. LOINC 2458-8, unit g/L, system metabolic, region immune. No single body location. No published reference interval.
- IgG (BM-432): IgG [Mass/volume] in Serum or Plasma. LOINC 2465-3, unit g/L, system metabolic, region immune. No single body location. No published reference interval.
- IgM (BM-433): IgM [Mass/volume] in Serum or Plasma. LOINC 2472-9, unit g/L, system metabolic, region immune. No single body location. No published reference interval.

# Section: Metabolic system markers: kidney

- Harnsäure (BM-136): Urate [Mass/volume] in Serum or Plasma. LOINC 3084-1, unit mg/dL, system metabolic, region kidney. No single body location.
- Kalium (BM-177): Potassium [Moles/volume] in Serum or Plasma. LOINC 2823-3, unit mmol/L, system metabolic, region kidney, electrolyte balance.
- Natrium (BM-286): Sodium [Moles/volume] in Serum or Plasma. LOINC 2951-2, unit mmol/L, system metabolic, region kidney, electrolyte balance.
- Kreatinin (BM-436): Creatinine [Mass/volume] in Serum or Plasma. LOINC 2160-0, unit mg/dL, system metabolic, region kidney. No single body location. No published reference interval.

# Section: Metabolic system markers: metabolic glycemic

- Glukose (BM-128): Fasting glucose [Mass/volume] in Serum or Plasma. LOINC 1558-6, unit mg/dL, system metabolic, region metabolic glycemic.
- HbA1c (BM-139): Hemoglobin A1c/Hemoglobin.total in Blood. LOINC 4548-4, unit %, system metabolic, region metabolic glycemic.

# Section: Metabolic system markers: micronutrient status (part 1 of 2)

- Biotin (Vitamin B7) (BM-057): Biotin [Mass/volume] in Serum or Plasma. LOINC 1980-2, unit ng/L, system metabolic, region micronutrient status. No published reference interval.
- Bor (BM-060): Boron [Moles/volume] in Serum or Plasma. LOINC 52914-9, unit ug/L, system metabolic, region micronutrient status. Unit flagged in Anchor, so no position is shown.
- Folsäure (Vitamin B9) (BM-111): Folate [Mass/volume] in Serum or Plasma. LOINC 2284-8, unit ng/mL, system metabolic, region micronutrient status.
- Homocystein (BM-156): Homocysteine [Moles/volume] in Serum or Plasma. LOINC 13965-9, unit umol/L, system metabolic, region micronutrient status. No published reference interval.
- Jod (BM-176): Iodine [Mass/volume] in Serum or Plasma. LOINC 2494-3, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Kupfer (BM-186): Copper [Moles/volume] in Serum or Plasma. LOINC 14665-4, unit ug/L, system metabolic, region micronutrient status. Unit flagged in Anchor, so no position is shown. No published reference interval.
- Selen (BM-341): Selenium [Mass/volume] in Serum or Plasma. LOINC 5724-0, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin A (BM-392): Retinol [Mass/volume] in Serum or Plasma. LOINC 2923-1, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin B1 (Thiamin) (BM-393): Thiamine [Mass/volume] in Blood. LOINC 2998-3, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin B12 (BM-394): Cobalamins [Mass/volume] in Serum or Plasma. LOINC 2132-9, unit pg/mL, system metabolic, region micronutrient status.
- Vitamin B2 (Riboflavin) (BM-395): Riboflavin [Mass/volume] in Serum or Plasma. LOINC 2924-9, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin B5 (Pantothensäure) (BM-397): Pantothenate [Mass/volume] in Serum or Plasma or Blood. LOINC 2722-7, unit ug/L, system metabolic, region micronutrient status. No published reference interval.

# Section: Metabolic system markers: micronutrient status (part 2 of 2)

- Vitamin B6 (BM-398): Pyridoxal phosphate [Mass/volume] in Serum or Plasma. LOINC 30552-4, unit ug/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin E (BM-404): Alpha tocopherol [Mass/volume] in Serum or Plasma. LOINC 1823-4, unit mg/L, system metabolic, region micronutrient status. No published reference interval.
- Vitamin K (BM-405): Phytonadione [Moles/volume] in Serum or Plasma. LOINC 58793-1, unit ng/L, system metabolic, region micronutrient status. Unit flagged in Anchor, so no position is shown. No published reference interval.
- Zink (BM-411): Zinc [Mass/volume] in Serum or Plasma. LOINC 5763-8, unit ug/L, system metabolic, region micronutrient status. No published reference interval.

# Section: Metabolic system markers: systemic inflammation

- CRP (hochsensitiv) (BM-079): C reactive protein [Mass/volume] in Serum or Plasma by High sensitivity method. LOINC 30522-7, unit mg/L, system metabolic, region systemic inflammation. No single body location.

# Section: Musculoskeletal system markers

- Calcium (BM-063): Calcium [Moles/volume] in Serum or Plasma. LOINC 2000-8, unit mmol/L, system musculoskeletal, region bone, electrolyte balance.
- Creatinkinase (CK) (BM-078): Creatine kinase [Enzymatic activity/volume] in Serum or Plasma. LOINC 2157-6, unit U/L, system musculoskeletal, region skeletal muscle. No published reference interval.
- Vitamin D (25-OH) (BM-401): Calcidiol [Mass/volume] in Serum or Plasma. LOINC 1989-3, unit ng/mL, system musculoskeletal, region bone. No published reference interval.
- CTX (Beta-Crosslaps) (BM-434): Collagen crosslinked C-telopeptide [Mass/volume] in Serum or Plasma. LOINC 41171-0, unit ng/mL, system musculoskeletal, region bone. No published reference interval.
- Desoxypyridinolin (DPD) (BM-435): Deoxypyridinoline/Creatinine [Molar ratio] in Urine. LOINC 25095-1, unit nmol/mmol, system musculoskeletal, region bone. No published reference interval.

# Section: Reproductive system markers

- 17-Beta-Östradiol (BM-001): Estradiol (E2) [Moles/volume] in Serum or Plasma. LOINC 14715-7, unit pmol/L, system reproductive, region gonads.
- Anti-Müller-Hormon (AMH) (BM-014): Mullerian inhibiting substance [Mass/volume] in Serum or Plasma by Immunoassay. LOINC 83104-0, unit ng/mL, system reproductive, region gonads. No published reference interval.
- Progesteron (BM-311): Progesterone [Moles/volume] in Serum or Plasma. LOINC 14890-8, unit nmol/L, system reproductive, region gonads.
- PSA (BM-315): Prostate specific Ag [Mass/volume] in Serum or Plasma. LOINC 2857-1, unit ng/mL, system reproductive, region prostate. No published reference interval.
- Testosteron (gesamt) (BM-358): Testosterone [Moles/volume] in Serum or Plasma. LOINC 14913-8, unit nmol/L, system reproductive, region gonads.
