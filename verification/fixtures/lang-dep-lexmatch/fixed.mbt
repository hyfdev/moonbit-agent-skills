fn release_current_scan(s : StringView) -> Int? {
  lexscan s {
    (re"\r?\n", before=line, after=_) => Some(line.length())
    _ => None
  }
}

test "current lexscan scan" {
  let source : StringView = "a\n"[0:2]
  assert_eq(release_current_scan(source), Some(1))
}
