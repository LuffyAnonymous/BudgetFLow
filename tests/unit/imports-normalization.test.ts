import { describe, expect, test } from "vitest";
import { normalizeCategories, normalizeImportsList } from "@/app/(dashboard)/imports/page";

describe("Imports Page Response Normalization Helpers", () => {
  describe("normalizeCategories", () => {
    test("empty response returns []", () => {
      expect(normalizeCategories(null)).toEqual([]);
      expect(normalizeCategories(undefined)).toEqual([]);
    });

    test("wrapped response extracts the data array", () => {
      const wrapped = {
        data: [
          { id: "1", name: "Salary", type: "INCOME" },
          { id: "2", name: "Groceries", type: "VARIABLE_EXPENSE" }
        ],
        error: null
      };
      expect(normalizeCategories(wrapped)).toEqual([
        { id: "1", name: "Salary", type: "INCOME" },
        { id: "2", name: "Groceries", type: "VARIABLE_EXPENSE" }
      ]);
    });

    test("malformed non-array response returns []", () => {
      const malformed = { data: "not-an-array" };
      expect(normalizeCategories(malformed)).toEqual([]);
      
      const completelyMalformed = "some-string-response";
      expect(normalizeCategories(completelyMalformed)).toEqual([]);
    });

    test("valid categories response (direct array) is returned directly", () => {
      const directArray = [
        { id: "1", name: "Salary", type: "INCOME" }
      ];
      expect(normalizeCategories(directArray)).toEqual([
        { id: "1", name: "Salary", type: "INCOME" }
      ]);
    });
  });

  describe("normalizeImportsList", () => {
    test("empty response returns []", () => {
      expect(normalizeImportsList(null)).toEqual([]);
      expect(normalizeImportsList(undefined)).toEqual([]);
    });

    test("nested wrapped response extracts the items array", () => {
      const wrapped = {
        data: {
          items: [
            { id: "101", institution: "ENBD", status: "REVIEW_REQUIRED" }
          ]
        },
        error: null
      };
      expect(normalizeImportsList(wrapped)).toEqual([
        { id: "101", institution: "ENBD", status: "REVIEW_REQUIRED" }
      ]);
    });

    test("flat wrapped response extracts the data array", () => {
      const wrapped = {
        data: [
          { id: "102", institution: "Mashreq", status: "REVIEW_REQUIRED" }
        ],
        error: null
      };
      expect(normalizeImportsList(wrapped)).toEqual([
        { id: "102", institution: "Mashreq", status: "REVIEW_REQUIRED" }
      ]);
    });

    test("malformed non-array response returns []", () => {
      const malformed = { data: { items: "not-an-array" } };
      expect(normalizeImportsList(malformed)).toEqual([]);

      const malformedFlat = { data: "not-an-array" };
      expect(normalizeImportsList(malformedFlat)).toEqual([]);
    });

    test("valid imports list response (direct array) is returned directly", () => {
      const directArray = [
        { id: "103", institution: "ENBD", status: "REVIEW_REQUIRED" }
      ];
      expect(normalizeImportsList(directArray)).toEqual([
        { id: "103", institution: "ENBD", status: "REVIEW_REQUIRED" }
      ]);
    });
  });
});
