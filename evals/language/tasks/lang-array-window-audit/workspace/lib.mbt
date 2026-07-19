///|
pub fn replace_and_audit(
  values : Array[Int],
  start : Int,
  end : Int,
  replacement : Int,
) -> Int {
  let selected = values[start:end]
  for i = start; i < end; i = i + 1 {
    values[i] = replacement
  }
  selected.fold(init=0, (sum, value) => sum + value)
}
