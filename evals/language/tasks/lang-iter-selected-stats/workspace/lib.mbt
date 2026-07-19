///|
pub fn selected_stats(values : Iter[Int], threshold : Int) -> (Int, Int) {
  let selected = values.filter(value => value > threshold)
  let count = selected.count()
  let sum = selected.fold(init=0, (total, value) => total + value)
  (count, sum)
}
