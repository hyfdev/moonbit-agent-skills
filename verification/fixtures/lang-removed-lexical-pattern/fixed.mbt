pub fn scan(text : String) -> Int {
  lexmatch text {
    (re"ab", before~, after~) => before.length() + after.length()
    _ => -1
  }
}
