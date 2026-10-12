fn line_length_before_newline(s : StringView) -> Int? {
  lexmatch s {
    (re"\r?\n", before=line, after=_) => Some(line.length())
    _ => None
  }
}

test "lexmatch finds a newline in a string view" {
  let source : StringView = "a\n"[0:2]
  assert_eq(line_length_before_newline(source), Some(1))
}
