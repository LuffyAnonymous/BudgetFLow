# SMS Import Fixtures

This directory contains redacted SMS fixtures used to test the SMS parsers.

## Wording and Formats Isolation

All formats except the Emirates NBD Salary format are treated as **SYNTHETIC** until compared and verified against actual messages received on the device.

| Fixture File | Bank | Wording Format | Verification Status | Target Confidence |
|---|---|---|---|---|
| `emirates-nbd/salary-valid.txt` | Emirates NBD | Salary Credit | **REDACTED_REAL** | `HIGH` / `MEDIUM` |
| `emirates-nbd/transfer-valid.txt` | Emirates NBD | Internal Transfer to Mashreq | **SYNTHETIC** | `LOW` (Review Required) |
| `emirates-nbd/atm-valid.txt` | Emirates NBD | ATM Cash Withdrawal | **SYNTHETIC** | `LOW` (Review Required) |
| `mashreq/purchase-valid.txt` | Mashreq | General Card Purchase | **SYNTHETIC** | `LOW` (Review Required) |
| `mashreq/nol-valid.txt` | Mashreq | RTA NOL Card Top-up | **SYNTHETIC** | `LOW` (Review Required) |
| `mashreq/tabby-valid.txt` | Mashreq | Tabby Debt Payment | **SYNTHETIC** | `LOW` (Review Required) |
| `mashreq/table-tennis-valid.txt` | Mashreq | Table Tennis Purchase | **SYNTHETIC** | `LOW` (Review Required) |
| `mashreq/taptap-valid.txt` | Mashreq | TapTap Send Remittance | **SYNTHETIC** | `LOW` (Review Required) |
