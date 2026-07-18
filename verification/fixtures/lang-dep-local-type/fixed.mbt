priv enum TopLevelType {
  TopLevelValue(Int)
}

pub fn top_level_type_value() -> Int {
  match TopLevelValue(42) {
    TopLevelValue(value) => value
  }
}
