#include "result_builder.hpp"

#include <algorithm>
#include <iomanip>
#include <sstream>
#include <string_view>
#include <vector>

#include "TracyWorker.hpp"

namespace mcdev::tracy_bridge {
namespace {

struct ZoneResult {
    std::string name;
    std::string sourceFile;
    std::uint32_t sourceLine;
    std::uint64_t calls;
    std::int64_t total;
    std::int64_t self;
    std::int64_t mean;
    std::int64_t maximum;
};

void appendJsonString(std::ostringstream& output, std::string_view value) {
    static constexpr char hex[] = "0123456789abcdef";
    output << '"';
    for (const unsigned char character : value) {
        switch (character) {
        case '"': output << "\\\""; break;
        case '\\': output << "\\\\"; break;
        case '\b': output << "\\b"; break;
        case '\f': output << "\\f"; break;
        case '\n': output << "\\n"; break;
        case '\r': output << "\\r"; break;
        case '\t': output << "\\t"; break;
        default:
            if (character < 0x20) {
                output << "\\u00" << hex[character >> 4] << hex[character & 0x0f];
            } else {
                output << static_cast<char>(character);
            }
        }
    }
    output << '"';
}

} // namespace

std::string buildResultJson(
    const tracy::Worker& worker,
    double capturedSeconds,
    std::uint32_t maximumZones
) {
    std::vector<ZoneResult> zones;
    const auto& sourceZones = worker.GetSourceLocationZones();
    zones.reserve(std::min<std::size_t>(sourceZones.size(), maximumZones));
    std::uint64_t totalZones = 0;
    const auto smallestFirst = [](const ZoneResult& left, const ZoneResult& right) {
        return left.total > right.total;
    };

    for (const auto& entry : sourceZones) {
        const auto& data = entry.second;
        if (data.total == 0 || data.zones.empty()) {
            continue;
        }
        ++totalZones;
        if (zones.size() == maximumZones && data.total <= zones.front().total) {
            continue;
        }
        const auto& source = worker.GetSourceLocation(entry.first);
        const char* name = worker.GetString(source.name.active ? source.name : source.function);
        const char* file = worker.GetString(source.file);
        const auto calls = static_cast<std::uint64_t>(data.zones.size());
        ZoneResult result{
            name ? name : "",
            file ? file : "",
            source.line,
            calls,
            data.total,
            data.selfTotal,
            calls == 0 ? 0 : data.total / static_cast<std::int64_t>(calls),
            data.max
        };
        if (zones.size() == maximumZones) {
            std::pop_heap(zones.begin(), zones.end(), smallestFirst);
            zones.back() = std::move(result);
            std::push_heap(zones.begin(), zones.end(), smallestFirst);
        } else {
            zones.push_back(std::move(result));
            std::push_heap(zones.begin(), zones.end(), smallestFirst);
        }
    }

    std::sort(zones.begin(), zones.end(), [](const ZoneResult& left, const ZoneResult& right) {
        return left.total > right.total;
    });

    std::ostringstream output;
    output << std::setprecision(15)
           << "{\"capturedSeconds\":" << capturedSeconds
           << ",\"totalZones\":" << totalZones
           << ",\"truncated\":" << (totalZones > zones.size() ? "true" : "false")
           << ",\"zones\":[";
    for (std::size_t index = 0; index < zones.size(); ++index) {
        if (index != 0) output << ',';
        const auto& zone = zones[index];
        output << "{\"id\":" << index << ",\"name\":";
        appendJsonString(output, zone.name);
        output << ",\"sourceFile\":";
        appendJsonString(output, zone.sourceFile);
        output << ",\"sourceLine\":" << zone.sourceLine
               << ",\"calls\":" << zone.calls
               << ",\"totalNanoseconds\":" << std::max<std::int64_t>(0, zone.total)
               << ",\"selfNanoseconds\":" << std::max<std::int64_t>(0, zone.self)
               << ",\"meanNanoseconds\":" << std::max<std::int64_t>(0, zone.mean)
               << ",\"maximumNanoseconds\":" << std::max<std::int64_t>(0, zone.maximum)
               << '}';
    }
    output << "]}";
    return output.str();
}

} // namespace mcdev::tracy_bridge
