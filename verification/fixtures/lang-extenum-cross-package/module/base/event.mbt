pub(all) extenum Event[T] {
  Started(T)
}

pub(all) extenum Event[T] += {
  Stopped(T)
}
