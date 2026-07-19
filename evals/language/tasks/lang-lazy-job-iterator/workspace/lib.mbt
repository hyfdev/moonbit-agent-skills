///|
pub fn planned_jobs(log : Array[String]) -> Iter[Int] {
  [|
    {
      log.push("prepare 10")
      10
    },
    {
      log.push("prepare 20")
      20
    },
    {
      log.push("prepare 30")
      30
    },
  |]
}
