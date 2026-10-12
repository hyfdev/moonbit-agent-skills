pub fn consume(input : String) -> Int {
  lexmatch input {
    (re"^.*$", before=_, after=_) => 1
    _ => 0
  }
}
