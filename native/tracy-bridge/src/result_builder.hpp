#pragma once

#include <cstdint>
#include <string>

namespace tracy { class Worker; }

namespace mcdev::tracy_bridge {

std::string buildResultJson(
    const tracy::Worker& worker,
    double capturedSeconds,
    std::uint32_t maximumZones
);

} // namespace mcdev::tracy_bridge

