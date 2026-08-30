import { IEmailParser, NormalizedEmailTransaction } from "../email-parser.interface";

// TODO: no real Mashreq sender domain or sample transaction email has been
// supplied yet. Do NOT guess at a domain or field format here — this stays
// a non-matching stub until a real (redacted) sample is available, per the
// "no fabricated bank parsers" rule this pipeline was built under.
export class MashreqEmailParser implements IEmailParser {
  readonly parserKey = "mashreq-email-stub-v1";
  readonly parserVersion = "0.0.0";
  readonly institution = "Mashreq";

  canParse(_fromAddress: string, _subject: string, _body: string): boolean {
    return false;
  }

  parse(): NormalizedEmailTransaction | null {
    return null;
  }
}

export const mashreqEmailParser = new MashreqEmailParser();
