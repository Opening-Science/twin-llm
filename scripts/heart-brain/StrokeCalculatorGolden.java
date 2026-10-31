/*
 * Golden values for scripts/heart-brain/stroke-calculator.ts, computed by the
 * pinned Synthea v4.0.0 jar itself. Run from the repository root with the jar
 * that `bun run synthea` caches:
 *
 *   java -cp .synthea/cache/synthea-with-dependencies.jar \
 *     scripts/heart-brain/StrokeCalculatorGolden.java \
 *     > scripts/heart-brain/stroke-calculator.golden.json
 *
 * With the argument `full` it prints every combination of the edge ages,
 * edge blood pressures and flags instead (about 60,000 rows), for a one-off
 * check that is too large to keep in the repository. A person without a
 * systolic BP is left out: `Person.getVitalSign` throws for one, so the
 * calculator never sees it.
 *
 * Each row: [sex, age, systolic, bpTreated, smoker, diabetes, af,
 * chd, lvh, stroke10Year(person, time, false), stroke10Year(person, time, true)].
 */
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

import org.mitre.synthea.modules.calculators.Framingham;
import org.mitre.synthea.world.agents.Person;
import org.mitre.synthea.world.concepts.VitalSign;

public class StrokeCalculatorGolden {
  private static final LocalDate TODAY = LocalDate.of(2020, 6, 15);
  private static final long TIME = TODAY.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();

  private static final int[] AGES = {
    19, 20, 21, 39, 40, 41, 54, 55, 56, 57, 58, 59, 60, 61, 63, 64, 65, 66, 67, 68, 69, 70,
    71, 72, 73, 74, 76, 77, 79, 80, 82, 83, 85, 86, 95
  };

  private static final int[][] BP_TABLES = {
    {0, 106, 116, 126, 136, 146, 156, 166, 176, 185, 196},
    {0, 95, 107, 119, 131, 144, 156, 168, 181, 193, 205},
    {0, 106, 113, 118, 124, 130, 136, 143, 151, 162, 177},
    {0, 95, 107, 114, 120, 126, 132, 140, 149, 161, 205},
  };

  private static String row(String sex, int age, Double bp, boolean[] flags) {
    Person person = new Person(1L);
    person.attributes.put(Person.GENDER, sex);
    long birth = TODAY.minusYears(age).minusDays(100).atStartOfDay(ZoneOffset.UTC)
        .toInstant().toEpochMilli();
    person.attributes.put(Person.BIRTHDATE, birth);
    if (bp != null) {
      person.setVitalSign(VitalSign.SYSTOLIC_BLOOD_PRESSURE, bp);
    }
    String[] names = {
      "blood_pressure_controlled", "smoker", "diabetes", "atrial_fibrillation",
      "coronary_heart_disease", "left_ventricular_hypertrophy"
    };
    for (int i = 0; i < names.length; i++) {
      if (flags[i]) {
        person.attributes.put(names[i], Boolean.TRUE);
      }
    }
    double tenYear = Framingham.stroke10Year(person, TIME, false);
    double perStep = Framingham.stroke10Year(person, TIME, true);
    StringBuilder out = new StringBuilder();
    out.append("[\"").append(sex).append("\",").append(person.ageInYears(TIME)).append(',')
        .append(bp == null ? "null" : bp.toString());
    for (boolean flag : flags) {
      out.append(',').append(flag);
    }
    out.append(',').append(tenYear).append(',').append(perStep).append(']');
    return out.toString();
  }

  public static void main(String[] args) {
    boolean full = args.length > 0 && args[0].equals("full");
    TreeSet<Double> bps = new TreeSet<>();
    for (int[] table : BP_TABLES) {
      for (int edge : table) {
        for (int d = -1; d <= 1; d++) {
          if (edge + d >= 0) {
            bps.add((double) (edge + d));
          }
        }
      }
    }
    bps.add(128.7);
    bps.add(250.0);
    List<Double> bpList = new ArrayList<>(bps);
    List<String> rows = new ArrayList<>();
    String[] sexes = {"M", "F"};
    if (full) {
      for (String sex : sexes) {
        for (int age : AGES) {
          for (Double bp : bpList) {
            for (int mask = 0; mask < 64; mask++) {
              boolean[] flags = new boolean[6];
              for (int i = 0; i < 6; i++) {
                flags[i] = ((mask >> i) & 1) == 1;
              }
              rows.add(row(sex, age, bp, flags));
            }
          }
        }
      }
    } else {
      // A fixed linear congruential sequence, so the file is the same on every run.
      long state = 294L;
      for (int n = 0; n < 600; n++) {
        long[] draws = new long[4];
        for (int k = 0; k < 4; k++) {
          state = (state * 6364136223846793005L + 1442695040888963407L);
          draws[k] = (state >>> 33);
        }
        String sex = sexes[(int) (draws[0] % 2)];
        int age = AGES[(int) (draws[1] % AGES.length)];
        Double bp = bpList.get((int) (draws[2] % bpList.size()));
        boolean[] flags = new boolean[6];
        for (int i = 0; i < 6; i++) {
          flags[i] = ((draws[3] >> i) & 1) == 1;
        }
        rows.add(row(sex, age, bp, flags));
      }
    }
    System.out.println("[");
    for (int i = 0; i < rows.size(); i++) {
      System.out.println("  " + rows.get(i) + (i + 1 < rows.size() ? "," : ""));
    }
    System.out.println("]");
  }
}
