fn release_old_scan(s : StringView) -> Int? {
  lexmatch s {
    (re"\r?\n", before=line, after=_) => Some(line.length())
    _ => None
  }
}

test "legacy lexmatch scan" {
  let source : StringView = "a\n"[0:2]
  assert_eq(release_old_scan(source), Some(1))
}
