suberror Failure { Failed }
#warnings("-deprecated_syntax")
pub fn legacy(value : Int) -> Int!Failure {
  if value < 0 { raise Failed }; value
}
