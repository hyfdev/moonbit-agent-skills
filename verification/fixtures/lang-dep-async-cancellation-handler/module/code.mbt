pub async fn handle(callback : async () -> Unit) -> Unit { @async.with_cancellation_handler(callback, handler=() => ()) }
