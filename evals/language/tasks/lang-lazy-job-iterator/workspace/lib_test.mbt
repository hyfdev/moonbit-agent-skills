///|
test "collects every planned job" {
  let log : Array[String] = []
  assert_eq(@lazy_job_iterator.planned_jobs(log).collect(), [10, 20, 30])
}

///|
test "records every preparation after full collection" {
  let log : Array[String] = []
  ignore(@lazy_job_iterator.planned_jobs(log).collect())
  assert_eq(log, ["prepare 10", "prepare 20", "prepare 30"])
}
