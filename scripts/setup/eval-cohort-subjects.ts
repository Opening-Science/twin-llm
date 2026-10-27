/**
 * The 37 subject ids (`Patient.id`) of the pinned evaluation cohort
 * `synthea-v4-seed42`, sorted. Read once from the `eval-cohort-v1` release
 * archive (SHA-256 as in `EVAL_RELEASE`), so tests can check cohort
 * membership without downloading it.
 *
 * Three of them are also the trimmed fixtures in `tests/fixtures/synthea`
 * (#96): `setup:local` deletes the fixture cohort before it loads this one.
 */
export const EVAL_COHORT_SUBJECTS: readonly string[] = [
  "080b069b-5108-46b6-ecef-6aacd3b9ef3f",
  "1d55f0c1-61a7-4b6f-d3f2-c851cb83ec60",
  "2c167999-289d-95fa-5c27-7d8b8d35348c",
  "2d68ad16-268a-478c-1f84-d0f1976e1a46",
  "35b353dd-402b-571a-d67a-af0a104d0854",
  "46976cf7-b0bf-be20-39a5-9f425a52886d",
  "46ee9d82-b52c-856d-069b-5064ff052225",
  "4f083ce3-f12b-bb4b-7353-e17f0cd55b0a",
  "5ba0a3f3-32f7-02b1-ec6a-8f568923954c",
  "5e688e99-61b3-5c88-3f60-21df8aaced27",
  "62f60bdb-cc5c-8305-b98b-f2b229a55eca",
  "644ed582-2e59-8b56-564b-9312d1f0d244",
  "6816a11d-3700-1d60-8b4d-b7252c529f11",
  "6aed9210-c500-4375-b0fc-3374c40b8591",
  "6fbddf55-7096-b883-7cd3-260f27953080",
  "76b20010-c318-5754-8c85-983aa538522f",
  "7fff03da-06e1-4c8f-091b-a415e649d0c8",
  "922fb35e-148d-9e82-7e65-bfa05e3b3515",
  "947c82ee-1735-c9ed-8210-38cb93d8070c",
  "9661a432-4630-2cd9-142c-386845fae837",
  "982750f4-569b-5949-196b-60699bdda3fb",
  "aa616abe-1761-0c9a-7959-07544679dafd",
  "aee7bbe1-0c45-c028-1e62-1f4cdb30c273",
  "b1137b71-d58f-a737-e56f-5021902058ab",
  "b6a1cac9-8873-36a7-e726-4aad8a07d44d",
  "ba419d35-0dfe-8af7-347c-eebf02485a56",
  "bff9d9d5-ee3d-d852-9c67-36d8361a4a4a",
  "c053e996-a4c4-6c02-e2b6-284227156c67",
  "c0a47dee-cc72-29ce-df5a-ea6d306c36a4",
  "c53d2b30-e23b-ae02-ed09-833abd033a39",
  "c67556bf-36d9-dd90-9b8a-43dbff31b428",
  "c86c400e-ff88-a1e3-2e23-caa4d8311f47",
  "d15b23ed-02d5-3e28-efbd-2604425317c5",
  "d3727ff2-5d7b-347f-d78c-edc4323cf890",
  "e74367bd-7385-97dc-2c7f-251b4cd9fe29",
  "eb5910f1-26e6-bc6f-b300-716eae678d6f",
  "f95a6723-14a5-c4b6-78df-fa97f7ab361c",
];
