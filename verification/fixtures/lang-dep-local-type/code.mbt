fn local_type_value() -> Int {
  enum LocalType {
    LocalValue(Int)
  }
  match LocalValue(42) {
    LocalValue(value) => value
  }
}
