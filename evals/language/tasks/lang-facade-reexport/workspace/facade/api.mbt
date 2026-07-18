///|
using @origin {open_handle, trait Service, type Handle}

///|
pub fn facade_service_id(id : Int) -> Int {
  let handle : Handle = open_handle(id)
  Service::service_id(handle)
}
