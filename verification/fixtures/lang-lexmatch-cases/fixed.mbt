pub fn consume(input : String) -> Int {
  lexmatch input {
    re"^.*$" => 1
  }
}
