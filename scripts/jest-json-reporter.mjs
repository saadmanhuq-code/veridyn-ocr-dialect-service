/**
 * Node test-runner reporter that emits a Jest/pytest-json-report-compatible
 * JSON document. Used by the integrity gate so assertReadinessLedger can read
 * the test report with its existing parser.
 *
 * Output shape:
 *   { testResults: [{ assertionResults: [{ status, fullName, title }] }] }
 *
 * This is intentionally a thin format adapter — no guard logic lives here.
 */

import { Transform } from "node:stream";

export default class JestJsonReporter extends Transform {
  constructor(options) {
    super({ ...options, objectMode: true });
    this.results = [];
  }

  _transform(event, _encoding, callback) {
    const { type, data } = event;
    const name = data?.name;

    if (type === "test:pass" && name) {
      this.results.push({ status: "passed", fullName: name, title: name });
    } else if (type === "test:fail" && name) {
      this.results.push({ status: "failed", fullName: name, title: name });
    }

    callback();
  }

  _flush(callback) {
    const report = { testResults: [{ assertionResults: this.results }] };
    this.push(JSON.stringify(report, null, 2));
    callback();
  }
}
