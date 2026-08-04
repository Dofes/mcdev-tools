cmake_minimum_required(VERSION 3.24)

project(mcdev-tracy-bridge VERSION 0.1.0 LANGUAGES C CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "mcdev-tracy-bridge currently supports Windows x64 only")
endif()

include(FetchContent)
include(GNUInstallDirs)

option(MCDEV_TRACY_BUILD_TESTS "Build the bridge API tests" ON)

# The game currently embeds Tracy 0.11.1. The server protocol must match it exactly.
FetchContent_Declare(
    tracy
    URL https://github.com/wolfpld/tracy/archive/5d542dc09f3d9378d005092a4ad446bd405f819a.tar.gz
    URL_HASH SHA256=ab47dbd7c7f1364015f0fb2e5afe767bb86997783bbfdd6cb6d366b47f0a94ac
    DOWNLOAD_EXTRACT_TIMESTAMP FALSE
    SOURCE_SUBDIR mcdev-no-upstream-build
)

set(CAPSTONE_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_CSTOOL OFF CACHE BOOL "" FORCE)
set(CAPSTONE_BUILD_DIET OFF CACHE BOOL "" FORCE)
set(CAPSTONE_ARCHITECTURE_DEFAULT OFF CACHE BOOL "" FORCE)
set(CAPSTONE_X86_SUPPORT ON CACHE BOOL "" FORCE)
FetchContent_Declare(
    capstone
    URL https://github.com/capstone-engine/capstone/archive/5cca00533dadfe53181f1de3525f859769f69b65.tar.gz
    URL_HASH SHA256=ca0ef4998ec8a682b519a65d75e83e0fff5b0797c6e28942059976379fad5bc4
    DOWNLOAD_EXTRACT_TIMESTAMP FALSE
)

FetchContent_MakeAvailable(tracy capstone)

include(cmake/TracyServerMinimal.cmake)

add_library(mcdev-tracy-bridge SHARED
    src/api.cpp
    src/capture_session.cpp
    src/result_builder.cpp
)
target_compile_features(mcdev-tracy-bridge PRIVATE cxx_std_20)
target_compile_definitions(mcdev-tracy-bridge PRIVATE
    MCDEV_TRACY_BRIDGE_EXPORTS
    NOMINMAX
    WIN32_LEAN_AND_MEAN
    NO_PARALLEL_SORT
)
target_include_directories(mcdev-tracy-bridge
    PUBLIC include
    PRIVATE src
)
target_link_libraries(mcdev-tracy-bridge PRIVATE mcdev-tracy-server)
set_target_properties(mcdev-tracy-bridge PROPERTIES
    OUTPUT_NAME "mcdev-tracy-bridge"
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN YES
)

if(MSVC)
    target_compile_options(mcdev-tracy-bridge PRIVATE /W4 /permissive- /EHsc /utf-8)
    target_link_options(mcdev-tracy-bridge PRIVATE $<$<CONFIG:Release>:/OPT:REF> $<$<CONFIG:Release>:/OPT:ICF>)
endif()

install(TARGETS mcdev-tracy-bridge
    RUNTIME DESTINATION .
    LIBRARY DESTINATION .
)
install(FILES "${tracy_SOURCE_DIR}/LICENSE" DESTINATION licenses RENAME LICENSE-Tracy.txt)
install(FILES "${capstone_SOURCE_DIR}/LICENSE.TXT" DESTINATION licenses RENAME LICENSE-Capstone.txt)

if(MCDEV_TRACY_BUILD_TESTS)
    enable_testing()
    add_executable(mcdev-tracy-bridge-tests tests/api_tests.cpp)
    target_compile_features(mcdev-tracy-bridge-tests PRIVATE cxx_std_20)
    target_link_libraries(mcdev-tracy-bridge-tests PRIVATE mcdev-tracy-bridge)
    add_test(NAME mcdev-tracy-bridge-api COMMAND mcdev-tracy-bridge-tests)
endif()
