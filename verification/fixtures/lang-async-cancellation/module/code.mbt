async fn suspend_with_possible_error() -> Unit {
  @async.sleep(10000)
  fail("ordinary failure")
}

pub async fn call_non_cancellable(
  callback : async () -> Int noraise + nocancel,
) -> Int noraise + nocancel {
  callback()
}

async test "cancellation skips catch and triggers deferred cleanup" {
  let log : Array[String] = []
  @async.with_task_group(group => {
    let child = group.spawn(() => {
      let first = @async.handle_cancellation(() => {
        defer @async.protect_from_cancel(() => {
          @async.sleep(1)
          log.push("defer")
        })
        errdefer log.push("errdefer")
        try suspend_with_possible_error() catch {
          _ => log.push("catch")
        }
      })
      assert_true(first is None)
      let second = @async.handle_cancellation(() => @async.sleep(1))
      assert_true(second is None)
      let guarded_result = @async.protect_from_cancel(() => {
        @async.sleep(1)
        9
      })
      assert_eq(guarded_result, 9)
    })
    @async.pause()
    child.cancel()
    child.wait()
  })
  assert_eq(log, ["errdefer", "defer"])
}

async test "async pipeline and nocancel callback" {
  let result = 21 |> value => {
    @async.sleep(1)
    value * 2
  }
  assert_eq(result, 42)
  assert_eq(call_non_cancellable(() => 7), 7)
}

async test "task-group deferred cleanup is nocancel" {
  let log : Array[String] = []
  @async.with_task_group(group => {
    group.add_defer(() => @async.protect_from_cancel(() => {
      @async.sleep(1)
      log.push("cleanup")
    }))
    @async.pause()
  })
  assert_eq(log, ["cleanup"])
}

#warnings("-deprecated")
test "cancellation has no Error value" {
  assert_false(@async.is_cancellation_error(Failure("ordinary")))
}
