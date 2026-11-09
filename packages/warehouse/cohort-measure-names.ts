/**
 * Short plain names for the LOINC codes the synthetic Synthea cohort holds
 * (`evaluation/cohort-codes.v1.json`) that neither the wearable measures nor
 * the Anchor catalogue name, so the tool trace never says "this measure" for
 * them (#542). Each entry's comment is the display Synthea writes for the
 * code, which is LOINC's name for it (LOINC codes and names are © Regenstrief
 * Institute, Inc., LOINC licence, see NOTICE). The short name is ours. Pure,
 * so the browser can read it.
 */
export const COHORT_MEASURE_NAMES: ReadonlyMap<string, string> = new Map([
  // Basophils [#/volume] in Blood by Automated count
  ["704-7", "Basophil count"],
  // Basophils/Leukocytes in Blood by Automated count
  ["706-2", "Basophils, % of white cells"],
  // Eosinophils [#/volume] in Blood by Automated count
  ["711-2", "Eosinophil count"],
  // Eosinophils/Leukocytes in Blood by Automated count
  ["713-8", "Eosinophils, % of white cells"],
  // Lymphocytes [#/volume] in Blood by Automated count
  ["731-0", "Lymphocyte count"],
  // Lymphocytes/Leukocytes in Blood by Automated count
  ["736-9", "Lymphocytes, % of white cells"],
  // Monocytes [#/volume] in Blood by Automated count
  ["742-7", "Monocyte count"],
  // Neutrophils [#/volume] in Blood by Automated count
  ["751-8", "Neutrophil count"],
  // Neutrophils/Leukocytes in Blood by Automated count
  ["770-8", "Neutrophils, % of white cells"],
  // Erythrocyte [DistWidth] in Blood by Automated count
  ["788-0", "Red cell distribution width"],
  // Albumin [Mass/volume] in Serum or Plasma
  ["1751-7", "Albumin"],
  // Bicarbonate [Moles/volume] in Arterial blood
  ["1960-4", "Bicarbonate in arterial blood"],
  // Bilirubin.total [Mass/volume] in Serum or Plasma
  ["1975-2", "Bilirubin"],
  // C reactive protein [Mass/volume] in Serum or Plasma
  ["1988-5", "C-reactive protein"],
  // Carbon dioxide [Partial pressure] in Arterial blood
  ["2019-8", "Carbon dioxide pressure in arterial blood"],
  // Carbon dioxide [Partial pressure] in Venous blood
  ["2021-4", "Carbon dioxide pressure in venous blood"],
  // Carbon dioxide, total [Moles/volume] in Venous blood
  ["2027-1", "Total carbon dioxide in venous blood"],
  // Carbon dioxide, total [Moles/volume] in Serum or Plasma
  ["2028-9", "Total carbon dioxide"],
  // Chloride [Moles/volume] in Blood
  ["2069-3", "Chloride in blood"],
  // Chloride [Moles/volume] in Serum or Plasma
  ["2075-0", "Chloride"],
  // Glucose [Mass/volume] in Blood
  ["2339-0", "Blood glucose"],
  // Glucose [Mass/volume] in Serum or Plasma
  ["2345-7", "Glucose"],
  // Iron [Mass/volume] in Serum or Plasma
  ["2498-4", "Iron"],
  // Iron binding capacity [Mass/volume] in Serum or Plasma
  ["2500-7", "Iron binding capacity"],
  // Iron saturation [Mass Fraction] in Serum or Plasma
  ["2502-3", "Iron saturation"],
  // Ketones [Presence] in Urine by Test strip
  ["2514-8", "Ketones in urine"],
  // Oxygen [Partial pressure] in Arterial blood
  ["2703-7", "Oxygen pressure in arterial blood"],
  // Oxygen [Partial pressure] in Venous blood
  ["2705-2", "Oxygen pressure in venous blood"],
  // Oxygen saturation in Arterial blood
  ["2708-6", "Oxygen saturation in arterial blood"],
  // pH of Arterial blood
  ["2744-1", "pH of arterial blood"],
  // pH of Venous blood
  ["2746-6", "pH of venous blood"],
  // Phosphate [Mass/volume] in Serum or Plasma
  ["2777-1", "Phosphate"],
  // Sodium [Moles/volume] in Blood
  ["2947-0", "Sodium in blood"],
  // Urea nitrogen [Mass/volume] in Serum or Plasma
  ["3094-0", "Urea nitrogen"],
  // aPTT in Blood by Coagulation assay
  ["3173-2", "aPTT"],
  // Activated clotting time (ACT) of Blood by Coagulation assay
  ["3184-9", "Activated clotting time"],
  // Bilirubin.total [Presence] in Urine by Test strip
  ["5770-3", "Bilirubin in urine"],
  // Epithelial cells [#/area] in Urine sediment by Microscopy high power field
  ["5787-7", "Epithelial cells in urine"],
  // Glucose [Mass/volume] in Urine by Test strip
  ["5792-7", "Glucose in urine"],
  // Hemoglobin [Presence] in Urine by Test strip
  ["5794-3", "Blood in urine"],
  // Ketones [Mass/volume] in Urine by Test strip
  ["5797-6", "Ketones in urine, amount"],
  // Leukocyte esterase [Presence] in Urine by Test strip
  ["5799-2", "Leukocyte esterase in urine"],
  // Nitrite [Presence] in Urine by Test strip
  ["5802-4", "Nitrite in urine"],
  // pH of Urine by Test strip
  ["5803-2", "Urine pH"],
  // Protein [Mass/volume] in Urine by Test strip
  ["5804-0", "Protein in urine, amount"],
  // Specific gravity of Urine by Test strip
  ["5811-5", "Urine specific gravity"],
  // Leukocytes [#/area] in Urine sediment by Microscopy high power field
  ["5821-4", "White cells in urine"],
  // Prothrombin time (PT)
  ["5902-2", "Prothrombin time"],
  // Monocytes/Leukocytes in Blood by Automated count
  ["5905-5", "Monocytes, % of white cells"],
  // Potassium [Moles/volume] in Blood
  ["6298-4", "Potassium in blood"],
  // Urea nitrogen [Mass/volume] in Blood
  ["6299-2", "Urea nitrogen in blood"],
  // INR in Platelet poor plasma by Coagulation assay
  ["6301-6", "INR"],
  // Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma
  ["6768-6", "Alkaline phosphatase"],
  // Body Height
  ["8302-2", "Body height"],
  // Body temperature
  ["8310-5", "Body temperature"],
  // Diastolic Blood Pressure
  ["8462-4", "Diastolic blood pressure"],
  // Systolic Blood Pressure
  ["8480-6", "Systolic blood pressure"],
  // Left ventricular Ejection fraction
  ["10230-1", "Left ventricular ejection fraction"],
  // Globulin [Mass/volume] in Serum by calculation
  ["10834-0", "Globulin"],
  // Erythrocytes [#/area] in Urine sediment by Microscopy high power field
  ["13945-1", "Red cells in urine"],
  // Bicarbonate [Moles/volume] in Venous blood
  ["14627-4", "Bicarbonate in venous blood"],
  // Lactate dehydrogenase [Enzymatic activity/volume] in Serum or Plasma by Lactate to pyruvate reaction
  ["14804-9", "Lactate dehydrogenase"],
  // Microalbumin/Creatinine [Mass Ratio] in Urine
  ["14959-1", "Urine albumin to creatinine ratio"],
  // Calcium [Mass/volume] in Serum or Plasma
  ["17861-6", "Calcium"],
  // Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay
  ["18262-6", "LDL cholesterol"],
  // Magnesium [Mass/volume] in Serum or Plasma
  ["19123-9", "Magnesium"],
  // Oxygen/Total gas setting [Volume Fraction] Ventilator
  ["19994-3", "Ventilator oxygen setting"],
  // Protein [Presence] in Urine by Test strip
  ["20454-5", "Protein in urine"],
  // Bilirubin.total [Mass/volume] in Urine by Test strip
  ["20505-4", "Bilirubin in urine, amount"],
  // Carbon dioxide, total [Moles/volume] in Blood
  ["20565-8", "Total carbon dioxide in blood"],
  // Hematocrit [Volume Fraction] of Blood by calculation
  ["20570-8", "Haematocrit, calculated"],
  // Magnesium [Mass/volume] in Blood
  ["21377-7", "Magnesium in blood"],
  // Glucose [Presence] in Urine by Test strip
  ["25428-4", "Glucose in urine, presence"],
  // Platelet distribution width [Entitic volume] in Blood by Automated count
  ["32207-3", "Platelet distribution width"],
  // Platelet [Entitic mean volume] in Blood by Automated count
  ["32623-1", "Mean platelet volume"],
  // Size.maximum dimension in Tumor
  ["33728-7", "Tumour size"],
  // Polyp size greatest dimension
  ["33756-8", "Polyp size"],
  // Natriuretic peptide.B prohormone N-Terminal [Mass/volume] in Serum or Plasma
  ["33762-6", "NT-proBNP"],
  // Glomerular filtration rate [Volume Rate/Area] in Serum or Plasma by Creatinine-based formula (MDRD)/1.73 sq M
  ["33914-3", "eGFR"],
  // Procalcitonin [Mass/volume] in Serum or Plasma
  ["33959-8", "Procalcitonin"],
  // Pain severity - Reported
  ["38208-5", "Pain severity"],
  // DXA Radius and Ulna [T-score] Bone density
  ["38265-5", "Forearm bone density T-score"],
  // Creatinine [Mass/volume] in Blood
  ["38483-4", "Creatinine in blood"],
  // Patient Health Questionnaire 9 item (PHQ-9) total score [Reported]
  ["44261-6", "PHQ-9 depression score"],
  // History of Hospitalizations+Outpatient visits Narrative
  ["46240-8", "Hospital and outpatient visits"],
  // Fibrin D-dimer FEU [Mass/volume] in Platelet poor plasma
  ["48065-7", "D-dimer"],
  // Calcium [Mass/volume] in Blood
  ["49765-1", "Calcium in blood"],
  // Patient Health Questionnaire 2 item (PHQ-2) total score [Reported]
  ["55758-7", "PHQ-2 depression score"],
  // Hemoglobin.gastrointestinal.lower [Presence] in Stool by Immunoassay --1st specimen
  ["57905-2", "Blood in stool"],
  // Fall risk total [Morse Fall Scale]
  ["59460-6", "Morse fall risk score"],
  // Body mass index (BMI) [Percentile] Per age and sex
  ["59576-9", "BMI percentile for age and sex"],
  // How many people are living or staying at this address [#]
  ["63512-8", "People living at the address"],
  // What was your best estimate of the total income of all family members from all sources, before taxes, in last year [PhenX]
  ["63586-2", "Household income"],
  // Generalized anxiety disorder 7 item (GAD-7) total score [Reported.PHQ]
  ["70274-6", "GAD-7 anxiety score"],
  // Natriuretic peptide.B prohormone N-Terminal [Mass/volume] in Blood by Immunoassay
  ["71425-3", "NT-proBNP in blood"],
  // Pain severity - 0-10 verbal numeric rating [Score] - Reported
  ["72514-3", "Pain score, 0 to 10"],
  // Weight difference [Mass difference] --pre dialysis - post dialysis
  ["74006-8", "Weight lost during dialysis"],
  // Total score [AUDIT-C]
  ["75626-2", "AUDIT-C alcohol score"],
  // Pain severity in the past week - 0-10 numeric rating [Reported]
  ["75893-8", "Pain in the past week, 0 to 10"],
  // Total score [HARK]
  ["76504-0", "HARK score"],
  // Right eye Intraocular pressure
  ["79892-6", "Right eye pressure"],
  // Left eye Intraocular pressure
  ["79893-4", "Left eye pressure"],
  // Total score [DAST-10]
  ["82667-7", "DAST-10 drug use score"],
  // Lymph nodes with isolated tumor cells [#] in Cancer specimen by Light microscopy
  ["85352-3", "Lymph nodes with isolated tumour cells"],
  // Overall summary score [KCCQ-12]
  ["86924-8", "KCCQ-12 heart failure score"],
  // Patient Health Questionnaire-9: Modified for Teens total score [Reported.PHQ.Teen]
  ["89204-2", "PHQ-9 teen depression score"],
  // Troponin I.cardiac [Mass/volume] in Serum or Plasma by High sensitivity method
  ["89579-7", "Troponin I, high sensitivity"],
  // What number best describes how pain has interfered with your enjoyment of life during the past week
  ["91145-3", "Pain interfering with enjoyment of life"],
  // What number best describes how pain has interfered with your general activity during the past week
  ["91146-1", "Pain interfering with general activity"],
  // Visual acuity uncorrected Left eye
  ["98498-9", "Left eye visual acuity"],
  // Visual acuity uncorrected Right eye
  ["98499-7", "Right eye visual acuity"],
]);
