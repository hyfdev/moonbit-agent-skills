///|
pub trait Service {
  fn service_id(Self) -> Int
}

///|
pub struct Handle {
  id : Int
}

///|
pub impl Service for Handle with fn service_id(self) {
  self.id
}

///|
pub fn open_handle(id : Int) -> Handle {
  { id, }
}
