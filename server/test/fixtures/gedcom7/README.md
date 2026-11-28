# GEDCOM 7.0 test fixtures

Hand-written, original files (GEDCOM 7.0, UTF-8). They are regression goldens for server/test/gedcom7-fixtures.test.js.

## Why not the official GEDCOM.io sample files
- The official samples are at https://gedcom.io/testfiles/gedcom70/ (index: https://gedcom.io/tools/).
- The FamilySearch/GEDCOM repository (https://github.com/FamilySearch/GEDCOM, LICENSE raw: https://raw.githubusercontent.com/FamilySearch/GEDCOM/main/LICENSE) is Apache License 2.0. Its NOTICE says it covers the GEDCOM specification.
- No licence statement for the sample files themselves was found on gedcom.io or in the repository. Checked on 2026-11-28, so they were not copied. Hand-written files avoid the question.

## Files
| File | Content | Persons | Families |
|---|---|---|---|
| minimal.ged | HEAD + TRLR only | 0 | 0 |
| family.ged | 3 people, 1 family with MARR, BIRT and DEAT dates | 3 | 1 |
| remarriage.ged | one man with 2 FAMS (2 spouses), a child of the first family | 4 | 2 |

## sha256
Computed 2026-11-28 from the files in this folder.
    c29a542c38668265a2424d962e2f159641252125607c2f9c06ff90b9d99c69f1  minimal.ged
    f20810339815a4d4c6947712d8e9c4dd9179ade73559a3af05b5c387c87d1e49  family.ged
    2c664a00354c1cd05d477f930dbd35204dac560612cba682425c3783249b594d  remarriage.ged
