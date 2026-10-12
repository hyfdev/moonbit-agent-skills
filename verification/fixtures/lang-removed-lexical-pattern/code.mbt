pub fn scan(text : String) -> Int {
  lexmatch text {
    (before, "a" "b", after) => before.length() + after.length()
    _ => -1
  }
}
