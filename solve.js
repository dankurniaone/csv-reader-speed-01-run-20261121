// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly the answer
// readCsv returns for the same {text, header} — {columns, rows, errors} —
// but reads in chunks instead of one character at a time.
//
// The reference walks the text character by character, appending each one
// to the field it is building. That is O(n) tiny steps with a string
// concatenation per character. This reader instead jumps from one
// interesting character to the next with indexOf / a small delimiter regex
// and copies whole spans with slice, so the work per field is a couple of
// native scans plus one slice, whatever the field's length. Fields are
// almost always plain (no quote, no stray CR), so the common path is:
//
//   unquoted field: one regex exec finds the next comma / CR / LF, the
//   span before it is the field, the delimiter says how the field ended.
//   quoted field:   indexOf finds the next quote, CR or LF; spans between
//   them are copied whole, "" collapses to one quote, and a CR or CRLF
//   inside quotes becomes one LF (and counts one line).
//
// Everything else follows the reference's broken-row policy exactly:
// a U+FEFF at the very start is dropped; a line left with no characters
// is no record; outside quotes a CR not followed by LF is dropped and
// recorded as stray_cr; a field that opens with a quote runs to the next
// quote that is not doubled, what follows its closing quote up to the next
// comma or line break is appended as it stands (quote_junk when the field
// ends with anything appended); a quote that never closes is a literal
// character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal;
// fields stay strings, never trimmed or converted; columns is the first
// record when header is true, else null; rows are padded with "" (short_row)
// or cut (long_row) to the first record's width; each error is
// {code, line, row} in the order met, a record's short_row / long_row when
// it ends, line the 1-based line its record starts on.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. The two regexes are created fresh per call so no lastIndex
// state can leak between cases.

/** How a field ended: 0 at a comma (the record goes on), 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  const nextDelim = /[,\r\n]/g; // the next comma, CR or LF at or after a position
  const nextQuote = /["\r\n]/g; // the next quote, CR or LF at or after a position
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The unquoted reader's answer, shared so it returns without allocating:
  // uVal the field, uEnd how it ended, uAdd the characters it kept.
  let uVal = '';
  let uEnd = END;
  let uAdd = 0;

  // Reads unquoted characters onto `start` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr).
  function readUnquoted(start) {
    let value = start;
    let added = 0;
    for (;;) {
      if (pos >= n) {
        uVal = value;
        uEnd = END;
        uAdd = added;
        return;
      }
      nextDelim.lastIndex = pos;
      const hit = nextDelim.exec(text);
      if (hit === null) {
        value += text.slice(pos);
        added += n - pos;
        pos = n;
        uVal = value;
        uEnd = END;
        uAdd = added;
        return;
      }
      const i = hit.index;
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        pos = i + 1;
        uVal = value;
        uEnd = COMMA;
        uAdd = added;
        return;
      }
      if (c === 10) {
        pos = i + 1;
        line += 1;
        uVal = value;
        uEnd = BREAK;
        uAdd = added;
        return;
      }
      // A CR: a line break with the LF that follows it, else a stray CR.
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        uVal = value;
        uEnd = BREAK;
        uAdd = added;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = i + 1;
    }
  }

  // The quoted reader's answer, shared the same way.
  let qVal = '';
  let qEnd = END;

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      if (pos >= n) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        qVal = uVal;
        qEnd = uEnd;
        return;
      }
      nextQuote.lastIndex = pos;
      const hit = nextQuote.exec(text);
      if (hit === null) {
        // No quote, CR or LF left: the quote never closes.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        qVal = uVal;
        qEnd = uEnd;
        return;
      }
      const i = hit.index;
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          // A doubled quote is one quote inside the field.
          value += text.slice(pos, i);
          value += '"';
          pos = i + 2;
          continue;
        }
        value += text.slice(pos, i);
        pos = i + 1;
        if (pos >= n) {
          qVal = value;
          qEnd = END;
          return;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          qVal = value;
          qEnd = COMMA;
          return;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          qVal = value;
          qEnd = BREAK;
          return;
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          qVal = value;
          qEnd = BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands, up to
        // the next comma or line break.
        readUnquoted(value);
        if (uAdd > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        qVal = uVal;
        qEnd = uEnd;
        return;
      }
      // A line break inside quotes is one LF in the field, and one line.
      value += text.slice(pos, i);
      value += '\n';
      line += 1;
      pos = c === 13 && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
        fields.push(qVal);
        ended = qEnd;
      } else {
        quoted = false;
        readUnquoted('');
        fields.push(uVal);
        ended = uEnd;
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
