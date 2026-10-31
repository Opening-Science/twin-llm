import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sealedCipher } from "./field-cipher";
import { envelopeKeyId } from "./field-crypto";
import {
  MeshCheckError,
  meshContext,
  meshFileName,
  meshFilesWithKey,
  resealMeshFiles,
} from "./mesh-files";

const OLD = { keyId: "1111111111111111", dataKey: Buffer.alloc(32, 1) };
const NEW = { keyId: "2222222222222222", dataKey: Buffer.alloc(32, 2) };
const USER = "user-synthetic-1";
/** A made-up mesh: glTF magic and some bytes, nobody's body. */
const MESH = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(64, 7)]);
const SHA = createHash("sha256").update(MESH).digest("hex");

const folderWithPlainMesh = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mesh-"));
  await writeFile(join(dir, meshFileName(SHA, false)), MESH, { mode: 0o600 });
  return dir;
};

describe("mesh files at rest (#141)", () => {
  test("names and context", () => {
    expect(meshFileName(SHA, true)).toBe(`${SHA}.glb.enc`);
    expect(meshFileName(SHA, false)).toBe(`${SHA}.glb`);
    expect(meshContext(USER, SHA)).toBe(`vitronic.mesh.${USER}.${SHA}`);
  });

  test("migration seals, checks and removes the plain file; a second run changes nothing", async () => {
    const dir = await folderWithPlainMesh();
    const cipher = sealedCipher(OLD);
    expect(await resealMeshFiles(dir, USER, cipher)).toEqual({
      sealed: 1,
      resealed: 0,
      unchanged: 0,
    });
    expect(await readdir(dir)).toEqual([`${SHA}.glb.enc`]);
    const stored = await readFile(join(dir, `${SHA}.glb.enc`));
    expect(stored.includes(Buffer.from("glTF"))).toBe(false);
    expect((await stat(join(dir, `${SHA}.glb.enc`))).mode & 0o777).toBe(0o600);
    expect(cipher.openFile(meshContext(USER, SHA), stored).equals(MESH)).toBe(true);
    expect(await resealMeshFiles(dir, USER, cipher)).toEqual({
      sealed: 0,
      resealed: 0,
      unchanged: 1,
    });
  });

  test("a run stopped after sealing only removes the plain copy", async () => {
    const dir = await folderWithPlainMesh();
    const cipher = sealedCipher(OLD);
    await writeFile(
      join(dir, `${SHA}.glb.enc`),
      cipher.sealFile(meshContext(USER, SHA), MESH),
    );
    expect((await resealMeshFiles(dir, USER, cipher)).sealed).toBe(1);
    expect(await readdir(dir)).toEqual([`${SHA}.glb.enc`]);
  });

  test("rotation reseals files of the retiring key", async () => {
    const dir = await folderWithPlainMesh();
    await resealMeshFiles(dir, USER, sealedCipher(OLD));
    expect(await meshFilesWithKey(dir, OLD.keyId)).toBe(1);
    expect(await resealMeshFiles(dir, USER, sealedCipher(NEW, [OLD]))).toEqual({
      sealed: 0,
      resealed: 1,
      unchanged: 0,
    });
    expect(await meshFilesWithKey(dir, OLD.keyId)).toBe(0);
    expect(envelopeKeyId(await readFile(join(dir, `${SHA}.glb.enc`)))).toBe(NEW.keyId);
  });

  test("a plain file that does not match its hash is refused and kept", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mesh-"));
    await writeFile(join(dir, meshFileName("ab".repeat(32), false)), MESH);
    await expect(resealMeshFiles(dir, USER, sealedCipher(OLD))).rejects.toBeInstanceOf(
      MeshCheckError,
    );
    expect(await readdir(dir)).toEqual([`${"ab".repeat(32)}.glb`]);
  });

  test("a missing folder has nothing to seal", async () => {
    expect(
      await resealMeshFiles(
        join(tmpdir(), "no-such-mesh-folder"),
        USER,
        sealedCipher(OLD),
      ),
    ).toEqual({
      sealed: 0,
      resealed: 0,
      unchanged: 0,
    });
  });
});
