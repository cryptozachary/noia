const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isMedicalTopic,
  safetySystemAddendum,
  ensureMedicalDisclaimer
} = require("../src/services/safety");

describe("isMedicalTopic", () => {
  it("detects medical keywords", () => {
    assert.equal(isMedicalTopic("cancer treatment options"), true);
    assert.equal(isMedicalTopic("new drug discovery"), true);
    assert.equal(isMedicalTopic("patient diagnosis methods"), true);
    assert.equal(isMedicalTopic("anti-aging research"), true);
    assert.equal(isMedicalTopic("longevity studies"), true);
  });

  it("returns false for non-medical topics", () => {
    assert.equal(isMedicalTopic("battery technology"), false);
    assert.equal(isMedicalTopic("quantum computing"), false);
    assert.equal(isMedicalTopic("machine learning"), false);
  });

  it("is case-insensitive", () => {
    assert.equal(isMedicalTopic("CANCER Treatment"), true);
  });

  it("handles empty input", () => {
    assert.equal(isMedicalTopic(""), false);
    assert.equal(isMedicalTopic(null), false);
    assert.equal(isMedicalTopic(undefined), false);
  });
});

describe("safetySystemAddendum", () => {
  it("returns safety requirements text", () => {
    const result = safetySystemAddendum();
    assert.ok(result.includes("Safety and scientific integrity"));
    assert.ok(result.includes("confidence level"));
  });
});

describe("ensureMedicalDisclaimer", () => {
  it("returns empty string for empty input", () => {
    assert.equal(ensureMedicalDisclaimer(""), "");
  });

  it("returns unchanged text if disclaimer already present", () => {
    const text = "Report content. This is not medical advice.";
    assert.equal(ensureMedicalDisclaimer(text), text);
  });

  it("appends disclaimer to section 10 if present", () => {
    const text = "Report content\n\n10. Safety Note / Disclaimer\nExisting note.";
    const result = ensureMedicalDisclaimer(text);
    assert.ok(result.includes("Existing note."));
    assert.ok(result.includes("not medical advice"));
  });

  it("appends section 10 if not present", () => {
    const text = "Report content without section 10.";
    const result = ensureMedicalDisclaimer(text);
    assert.ok(result.includes("10. Safety Note / Disclaimer"));
    assert.ok(result.includes("not medical advice"));
  });
});
