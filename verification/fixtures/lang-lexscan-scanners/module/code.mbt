fn next_word(scanner : @lexbuf.StringScanner) -> String? {
  lexscan scanner with longest {
    re"^[ ]+" => next_word(scanner)
    re"^[a-z]+" as word => Some(word.to_owned())
    _ => None
  }
}
fn stream_word(scanner : @lexbuf.Lexbuf) -> String? {
  lexscan scanner with longest {
    re"^[ ]+" => stream_word(scanner)
    re"^[a-z]+" as word => Some(word.to_owned())
    _ => None
  }
}
test "StringScanner cursor and EOF" {
  let scanner = @lexbuf.StringScanner::{ data: "hello world"[:], cursor: 0 }
  assert_eq(next_word(scanner), Some("hello"))
  assert_eq(scanner.cursor, 5)
  assert_eq(next_word(scanner), Some("world"))
  assert_eq(scanner.cursor, 11)
  assert_eq(next_word(scanner), None)
  assert_eq(scanner.cursor, 11)
}
test "Lexbuf tokens span chunks" {
  let chunks = ["he", "llo ", "wor", "ld"].iter()
  let scanner = @lexbuf.Lexbuf::from_fn(() => chunks.next())
  assert_eq(stream_word(scanner), Some("hello"))
  assert_eq(stream_word(scanner), Some("world"))
  assert_eq(stream_word(scanner), None)
}
